/**
 * Workflow engine commands
 * chainlesschain workflow create|list|run|status|pause|resume|rollback|templates|delete
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  createWorkflow,
  listWorkflows,
  executeWorkflow,
  getExecutionLog,
  pauseExecution,
  resumeExecution,
  rollbackExecution,
  getTemplates,
  deleteWorkflow,
  TEMPLATE_TYPE,
  WORKFLOW_STATUS,
  NODE_STATUS,
  listTemplates,
  createCheckpoint,
  listCheckpoints,
  rollbackToCheckpoint,
  setBreakpoint,
  listBreakpoints,
  removeBreakpoint,
  exportWorkflow,
  importWorkflow,
  WORKFLOW_MATURITY_V2 as WMV2,
  RUN_LIFECYCLE_V2 as RLV2,
  registerWorkflowV2,
  activateWorkflowV2,
  pauseWorkflowV2,
  retireWorkflowV2,
  touchWorkflowV2,
  getWorkflowV2,
  listWorkflowsV2,
  createRunV2,
  startRunV2,
  completeRunV2,
  failRunV2,
  cancelRunV2,
  getRunV2,
  listRunsV2,
  autoPauseIdleWorkflowsV2,
  autoFailStuckRunsV2,
  getWorkflowEngineStatsV2,
  setMaxActiveWorkflowsPerOwnerV2,
  setMaxPendingRunsPerWorkflowV2,
  setWorkflowIdleMsV2,
  setRunStuckMsV2,
  getMaxActiveWorkflowsPerOwnerV2,
  getMaxPendingRunsPerWorkflowV2,
  getWorkflowIdleMsV2,
  getRunStuckMsV2,
} from "../lib/workflow-engine.js";
import fs from "fs";

export function registerWorkflowCommand(program) {
  const workflow = program
    .command("workflow")
    .description(
      "Workflow engine — create, run, and manage DAG-based workflows",
    );

  // workflow create <name>
  workflow
    .command("create <name>")
    .description("Create a new workflow")
    .option("-d, --description <desc>", "Workflow description")
    .option("-t, --template <id>", "Use a built-in template")
    .option("-s, --stages <json>", "Stages as JSON array")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let stages;
        if (options.template) {
          const templates = getTemplates();
          const tpl = templates.find((t) => t.id === options.template);
          if (!tpl) {
            logger.error(
              `Template not found: ${options.template}. Use "workflow templates" to list.`,
            );
            await shutdown();
            process.exit(1);
          }
          stages = tpl.stages;
        } else if (options.stages) {
          try {
            stages = JSON.parse(options.stages);
          } catch (_err) {
            logger.error("Invalid JSON for --stages");
            await shutdown();
            process.exit(1);
          }
        } else {
          logger.error("Provide --template <id> or --stages <json>");
          await shutdown();
          process.exit(1);
        }

        const result = createWorkflow(db, {
          name,
          description: options.description,
          stages,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.green(`Workflow created: ${result.id}`));
          logger.log(`  Name: ${chalk.cyan(name)}`);
          logger.log(`  Stages: ${result.stages.length}`);
          logger.log(`  Status: ${result.status}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow list
  workflow
    .command("list")
    .description("List all workflows")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const workflows = listWorkflows(db);

        if (options.json) {
          console.log(
            JSON.stringify(
              workflows.map((w) => ({
                id: w.id,
                name: w.name,
                description: w.description,
                status: w.status,
                stages: w.dag.length,
                created_at: w.created_at,
              })),
              null,
              2,
            ),
          );
        } else if (workflows.length === 0) {
          logger.info(
            'No workflows found. Create one with "chainlesschain workflow create"',
          );
        } else {
          logger.log(chalk.bold(`Workflows (${workflows.length}):\n`));
          for (const w of workflows) {
            logger.log(
              `  ${chalk.cyan(w.id)} — ${w.name} [${chalk.green(w.status)}]`,
            );
            if (w.description) logger.log(`    ${chalk.gray(w.description)}`);
            logger.log(`    Stages: ${w.dag.length}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow run <id>
  workflow
    .command("run <id>")
    .description("Execute a workflow")
    .option("-i, --input <json>", "Input data as JSON")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();

        let input = {};
        if (options.input) {
          try {
            input = JSON.parse(options.input);
          } catch (_err) {
            logger.error("Invalid JSON for --input");
            await shutdown();
            process.exit(1);
          }
        }

        const result = executeWorkflow(db, id, input);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.green(`Workflow executed: ${result.id}`));
          logger.log(`  Status: ${result.status}`);
          logger.log(`  Steps completed: ${result.log.length}`);
          for (const entry of result.log) {
            logger.log(
              `    ${chalk.gray("•")} ${entry.stageName} [${entry.type}] — ${chalk.green(entry.status)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow status <exec-id>
  workflow
    .command("status <exec-id>")
    .description("Show execution status and log")
    .option("--json", "Output as JSON")
    .action(async (execId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = getExecutionLog(db, execId);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.bold(`Execution: ${result.id}`));
          logger.log(`  Workflow: ${result.workflowId}`);
          logger.log(`  Status: ${chalk.cyan(result.status)}`);
          logger.log(`  Started: ${result.startedAt || "N/A"}`);
          logger.log(`  Completed: ${result.completedAt || "N/A"}`);
          if (result.log.length > 0) {
            logger.log(`  Log:`);
            for (const entry of result.log) {
              if (entry.stageName) {
                logger.log(
                  `    ${chalk.gray("•")} ${entry.stageName} — ${entry.status}`,
                );
              } else if (entry.action) {
                logger.log(
                  `    ${chalk.gray("•")} ${entry.action} at ${entry.timestamp}`,
                );
              }
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow pause <exec-id>
  workflow
    .command("pause <exec-id>")
    .description("Pause a running execution")
    .action(async (execId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = pauseExecution(db, execId);
        logger.log(chalk.yellow(`Execution paused: ${result.id}`));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow resume <exec-id>
  workflow
    .command("resume <exec-id>")
    .description("Resume a paused execution")
    .action(async (execId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = resumeExecution(db, execId);
        logger.log(chalk.green(`Execution resumed: ${result.id}`));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow rollback <exec-id>
  workflow
    .command("rollback <exec-id>")
    .description("Rollback an execution")
    .action(async (execId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = rollbackExecution(db, execId);
        logger.log(chalk.red(`Execution rolled back: ${result.id}`));

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow templates
  workflow
    .command("templates")
    .description("List built-in workflow templates")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const templates = getTemplates();

        if (options.json) {
          console.log(JSON.stringify(templates, null, 2));
        } else {
          logger.log(chalk.bold(`Workflow Templates (${templates.length}):\n`));
          for (const tpl of templates) {
            logger.log(`  ${chalk.cyan(tpl.id)} — ${tpl.name}`);
            logger.log(`    ${chalk.gray(tpl.description)}`);
            logger.log(
              `    Stages: ${tpl.stages.map((s) => s.name).join(" → ")}`,
            );
            logger.log("");
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow delete <id>
  workflow
    .command("delete <id>")
    .description("Delete a workflow")
    .action(async (id) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = deleteWorkflow(db, id);

        if (result.deleted) {
          logger.log(chalk.green(`Workflow deleted: ${id}`));
        } else {
          logger.warn(`Workflow not found: ${id}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow canonical-templates (Phase 82)
  workflow
    .command("canonical-templates")
    .description(
      "List 5 canonical Phase 82 templates (ci_cd/data_pipeline/...)",
    )
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const templates = listTemplates();
        if (options.json) {
          console.log(JSON.stringify(templates, null, 2));
        } else {
          logger.log(
            chalk.bold(`Canonical Phase 82 Templates (${templates.length}):\n`),
          );
          for (const tpl of templates) {
            logger.log(`  ${chalk.cyan(tpl.id)} — ${tpl.name}`);
            logger.log(`    ${chalk.gray(tpl.description)}`);
            logger.log(
              `    Stages: ${tpl.stages.map((s) => s.name).join(" → ")}`,
            );
            logger.log("");
          }
        }
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow statuses (Phase 82) — enum reference
  workflow
    .command("statuses")
    .description("Show workflow and node status enum values (Phase 82)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const payload = {
        workflow: WORKFLOW_STATUS,
        node: NODE_STATUS,
        template: TEMPLATE_TYPE,
      };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        logger.log(chalk.bold("Workflow statuses:"));
        for (const v of Object.values(WORKFLOW_STATUS)) {
          logger.log(`  ${chalk.cyan(v)}`);
        }
        logger.log(chalk.bold("\nNode statuses:"));
        for (const v of Object.values(NODE_STATUS)) {
          logger.log(`  ${chalk.cyan(v)}`);
        }
        logger.log(chalk.bold("\nTemplate types:"));
        for (const v of Object.values(TEMPLATE_TYPE)) {
          logger.log(`  ${chalk.cyan(v)}`);
        }
      }
    });

  // workflow checkpoint <exec-id>
  workflow
    .command("checkpoint <exec-id>")
    .description("Create a checkpoint snapshot of an execution")
    .option("--json", "Output as JSON")
    .action(async (execId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const cp = createCheckpoint(db, execId);
        if (options.json) {
          console.log(JSON.stringify(cp, null, 2));
        } else {
          logger.log(chalk.green(`Checkpoint created: ${cp.id}`));
          logger.log(`  Execution: ${cp.executionId}`);
          logger.log(`  Workflow:  ${cp.workflowId}`);
          logger.log(`  Captured:  ${cp.snapshot.capturedAt}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow checkpoints <exec-id>
  workflow
    .command("checkpoints <exec-id>")
    .description("List checkpoints for an execution")
    .option("--json", "Output as JSON")
    .action(async (execId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const list = listCheckpoints(db, execId);
        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else if (list.length === 0) {
          logger.info("No checkpoints for this execution.");
        } else {
          logger.log(chalk.bold(`Checkpoints (${list.length}):\n`));
          for (const cp of list) {
            logger.log(
              `  ${chalk.cyan(cp.id)} — ${cp.createdAt} (stage: ${cp.snapshot.currentStage || "?"})`,
            );
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow rollback-to <exec-id> <checkpoint-id>
  workflow
    .command("rollback-to <exec-id> <checkpoint-id>")
    .description("Rollback an execution to a specific checkpoint")
    .action(async (execId, cpId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = rollbackToCheckpoint(db, execId, cpId);
        logger.log(
          chalk.yellow(
            `Rolled back execution ${result.id} to checkpoint ${result.checkpointId}`,
          ),
        );
        logger.log(`  Status: ${chalk.cyan(result.status)}`);
        if (result.restoredStage) {
          logger.log(`  Restored stage: ${result.restoredStage}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow breakpoint-set <wf-id> <node-id> [condition]
  workflow
    .command("breakpoint-set <wf-id> <node-id>")
    .description("Set a breakpoint on a workflow node (optionally conditional)")
    .option(
      "-c, --condition <expr>",
      "Conditional expression, e.g. 'input.priority > 5'",
    )
    .option("--json", "Output as JSON")
    .action(async (wfId, nodeId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const bp = setBreakpoint(db, wfId, nodeId, options.condition || null);
        if (options.json) {
          console.log(JSON.stringify(bp, null, 2));
        } else {
          logger.log(chalk.green(`Breakpoint set: ${bp.id}`));
          logger.log(`  Node: ${chalk.cyan(bp.nodeId)}`);
          if (bp.condition) logger.log(`  Condition: ${bp.condition}`);
          else logger.log(`  Condition: ${chalk.gray("(unconditional)")}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow breakpoints <wf-id>
  workflow
    .command("breakpoints <wf-id>")
    .description("List breakpoints on a workflow")
    .option("--json", "Output as JSON")
    .action(async (wfId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const list = listBreakpoints(db, wfId);
        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else if (list.length === 0) {
          logger.info("No breakpoints for this workflow.");
        } else {
          logger.log(chalk.bold(`Breakpoints (${list.length}):\n`));
          for (const bp of list) {
            logger.log(
              `  ${chalk.cyan(bp.id)} @ node=${bp.nodeId} ${bp.enabled ? chalk.green("enabled") : chalk.gray("disabled")}`,
            );
            if (bp.condition) logger.log(`    when: ${bp.condition}`);
          }
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow breakpoint-remove <bp-id>
  workflow
    .command("breakpoint-remove <bp-id>")
    .description("Remove a breakpoint")
    .action(async (bpId) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = removeBreakpoint(db, bpId);
        if (result.removed) {
          logger.log(chalk.green(`Breakpoint removed: ${bpId}`));
        } else {
          logger.warn(`Breakpoint not found: ${bpId}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow export <wf-id>
  workflow
    .command("export <wf-id>")
    .description("Export a workflow as a JSON definition")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .action(async (wfId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const def = exportWorkflow(db, wfId);
        const json = JSON.stringify(def, null, 2);
        if (options.output) {
          fs.writeFileSync(options.output, json, "utf-8");
          logger.log(chalk.green(`Exported to ${options.output}`));
        } else {
          console.log(json);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // workflow import <file>
  workflow
    .command("import <file>")
    .description("Import a workflow from a JSON definition file")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      try {
        const raw = fs.readFileSync(file, "utf-8");
        let def;
        try {
          def = JSON.parse(raw);
        } catch (_err) {
          logger.error(`Invalid JSON in ${file}`);
          process.exit(1);
        }
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = importWorkflow(db, def);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.log(chalk.green(`Workflow imported: ${result.id}`));
          logger.log(`  Name: ${chalk.cyan(def.name)}`);
          logger.log(`  Stages: ${result.stages.length}`);
        }
        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ===== V2 Commands (cli 0.130.0) =====
  const _v2json = (o) => console.log(JSON.stringify(o, null, 2));
  workflow
    .command("workflow-maturities-v2")
    .description("List V2 workflow maturity states")
    .action(() => Object.values(WMV2).forEach((s) => console.log(s)));
  workflow
    .command("run-lifecycles-v2")
    .description("List V2 run lifecycle states")
    .action(() => Object.values(RLV2).forEach((s) => console.log(s)));
  workflow
    .command("stats-v2")
    .description("V2 stats")
    .action(() => _v2json(getWorkflowEngineStatsV2()));
  workflow
    .command("config-v2")
    .description("V2 config")
    .action(() => {
      console.log(
        `maxActiveWorkflowsPerOwner: ${getMaxActiveWorkflowsPerOwnerV2()}`,
      );
      console.log(
        `maxPendingRunsPerWorkflow: ${getMaxPendingRunsPerWorkflowV2()}`,
      );
      console.log(`workflowIdleMs: ${getWorkflowIdleMsV2()}`);
      console.log(`runStuckMs: ${getRunStuckMsV2()}`);
    });
  workflow
    .command("set-max-active-workflows-v2 <n>")
    .description("Set V2 active workflow cap")
    .action((n) => {
      setMaxActiveWorkflowsPerOwnerV2(Number(n));
      console.log("ok");
    });
  workflow
    .command("set-max-pending-runs-v2 <n>")
    .description("Set V2 pending run cap")
    .action((n) => {
      setMaxPendingRunsPerWorkflowV2(Number(n));
      console.log("ok");
    });
  workflow
    .command("set-workflow-idle-ms-v2 <n>")
    .description("Set V2 workflow idle ms")
    .action((n) => {
      setWorkflowIdleMsV2(Number(n));
      console.log("ok");
    });
  workflow
    .command("set-run-stuck-ms-v2 <n>")
    .description("Set V2 run stuck ms")
    .action((n) => {
      setRunStuckMsV2(Number(n));
      console.log("ok");
    });
  workflow
    .command("register-workflow-v2 <id>")
    .description("V2 register workflow")
    .requiredOption("-o, --owner <o>")
    .option("-n, --name <n>")
    .action((id, opts) =>
      _v2json(registerWorkflowV2({ id, owner: opts.owner, name: opts.name })),
    );
  workflow
    .command("activate-workflow-v2 <id>")
    .description("V2 activate")
    .action((id) => _v2json(activateWorkflowV2(id)));
  workflow
    .command("pause-workflow-v2 <id>")
    .description("V2 pause")
    .action((id) => _v2json(pauseWorkflowV2(id)));
  workflow
    .command("retire-workflow-v2 <id>")
    .description("V2 retire")
    .action((id) => _v2json(retireWorkflowV2(id)));
  workflow
    .command("touch-workflow-v2 <id>")
    .description("V2 touch")
    .action((id) => _v2json(touchWorkflowV2(id)));
  workflow
    .command("get-workflow-v2 <id>")
    .description("V2 get")
    .action((id) => _v2json(getWorkflowV2(id)));
  workflow
    .command("list-workflows-v2")
    .description("V2 list")
    .option("-o, --owner <o>")
    .option("-s, --status <s>")
    .action((opts) => _v2json(listWorkflowsV2(opts)));
  workflow
    .command("create-run-v2 <id>")
    .description("V2 create run")
    .requiredOption("-w, --workflow-id <w>")
    .option("-t, --trigger <t>")
    .action((id, opts) =>
      _v2json(
        createRunV2({ id, workflowId: opts.workflowId, trigger: opts.trigger }),
      ),
    );
  workflow
    .command("start-run-v2 <id>")
    .description("V2 start run")
    .action((id) => _v2json(startRunV2(id)));
  workflow
    .command("complete-run-v2 <id>")
    .description("V2 complete run")
    .action((id) => _v2json(completeRunV2(id)));
  workflow
    .command("fail-run-v2 <id>")
    .description("V2 fail run")
    .option("-e, --error <e>")
    .action((id, opts) => _v2json(failRunV2(id, opts.error)));
  workflow
    .command("cancel-run-v2 <id>")
    .description("V2 cancel run")
    .action((id) => _v2json(cancelRunV2(id)));
  workflow
    .command("get-run-v2 <id>")
    .description("V2 get run")
    .action((id) => _v2json(getRunV2(id)));
  workflow
    .command("list-runs-v2")
    .description("V2 list runs")
    .option("-w, --workflow-id <w>")
    .option("-s, --status <s>")
    .option("-t, --trigger <t>")
    .action((opts) =>
      _v2json(
        listRunsV2({
          workflowId: opts.workflowId,
          status: opts.status,
          trigger: opts.trigger,
        }),
      ),
    );
  workflow
    .command("auto-pause-idle-workflows-v2")
    .description("V2 auto-pause idle")
    .action(() => _v2json(autoPauseIdleWorkflowsV2()));
  workflow
    .command("auto-fail-stuck-runs-v2")
    .description("V2 auto-fail stuck")
    .action(() => _v2json(autoFailStuckRunsV2()));
}

// === Iter21 V2 governance overlay ===
export function registerWfgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "workflow");
  if (!parent) return;
  const L = async () => await import("../lib/workflow-engine.js");
  parent
    .command("wfgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.WFGOV_PROFILE_MATURITY_V2,
            stepLifecycle: m.WFGOV_STEP_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("wfgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveWfgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingWfgovStepsPerProfileV2(),
            idleMs: m.getWfgovProfileIdleMsV2(),
            stuckMs: m.getWfgovStepStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("wfgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveWfgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wfgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingWfgovStepsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wfgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setWfgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wfgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setWfgovStepStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wfgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--kind <v>", "kind")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerWfgovProfileV2({ id, owner, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  parent
    .command("wfgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateWfgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("wfgov-pause-v2 <id>")
    .description("Pause profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).pauseWfgovProfileV2(id), null, 2));
    });
  parent
    .command("wfgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveWfgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("wfgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchWfgovProfileV2(id), null, 2));
    });
  parent
    .command("wfgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getWfgovProfileV2(id), null, 2));
    });
  parent
    .command("wfgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listWfgovProfilesV2(), null, 2));
    });
  parent
    .command("wfgov-create-step-v2 <id> <profileId>")
    .description("Create step")
    .option("--stepName <v>", "stepName")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createWfgovStepV2({ id, profileId, stepName: o.stepName }),
          null,
          2,
        ),
      );
    });
  parent
    .command("wfgov-executing-step-v2 <id>")
    .description("Mark step as executing")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).executingWfgovStepV2(id), null, 2),
      );
    });
  parent
    .command("wfgov-complete-step-v2 <id>")
    .description("Complete step")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeStepWfgovV2(id), null, 2));
    });
  parent
    .command("wfgov-fail-step-v2 <id> [reason]")
    .description("Fail step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failWfgovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("wfgov-cancel-step-v2 <id> [reason]")
    .description("Cancel step")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelWfgovStepV2(id, reason), null, 2),
      );
    });
  parent
    .command("wfgov-get-step-v2 <id>")
    .description("Get step")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getWfgovStepV2(id), null, 2));
    });
  parent
    .command("wfgov-list-steps-v2")
    .description("List steps")
    .action(async () => {
      console.log(JSON.stringify((await L()).listWfgovStepsV2(), null, 2));
    });
  parent
    .command("wfgov-auto-pause-idle-v2")
    .description("Auto-pause idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoPauseIdleWfgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("wfgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck steps")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckWfgovStepsV2(), null, 2),
      );
    });
  parent
    .command("wfgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getWorkflowEngineGovStatsV2(), null, 2),
      );
    });
}
