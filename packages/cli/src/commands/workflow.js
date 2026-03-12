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
} from "../lib/workflow-engine.js";

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
}
