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
}
