/**
 * A2A (Agent-to-Agent) Protocol commands
 * chainlesschain a2a register|discover|submit|status|complete|fail|peers|cards|negotiate
 */

import chalk from "chalk";
import ora from "ora";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  registerCard,
  updateCard,
  discoverAgents,
  sendTask,
  completeTask,
  failTask,
  getTaskStatus,
  negotiateCapability,
  listPeers,
} from "../lib/a2a-protocol.js";

export function registerA2aCommand(program) {
  const a2a = program
    .command("a2a")
    .description("A2A Protocol — agent-to-agent communication");

  // a2a register <name>
  a2a
    .command("register")
    .description("Register an agent card")
    .argument("<name>", "Agent name")
    .option("--description <desc>", "Agent description", "")
    .option("--url <url>", "Agent endpoint URL", "")
    .option("--capabilities <csv>", "Comma-separated capabilities", "")
    .option("--skills <csv>", "Comma-separated skills", "")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const card = registerCard(db, {
          name,
          description: options.description,
          url: options.url,
          capabilities: options.capabilities
            ? options.capabilities.split(",").map((s) => s.trim())
            : [],
          skills: options.skills
            ? options.skills.split(",").map((s) => s.trim())
            : [],
        });

        if (options.json) {
          console.log(JSON.stringify(card, null, 2));
        } else {
          logger.success(
            `Agent registered: ${chalk.cyan(card.name)} ${chalk.gray(card.id)}`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a discover
  a2a
    .command("discover")
    .description("Discover agents by capability or skill")
    .option("--capability <name>", "Filter by capability")
    .option("--skill <name>", "Filter by skill")
    .option("--name <filter>", "Filter by name")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const agents = discoverAgents(db, {
          capability: options.capability,
          skill: options.skill,
          name: options.name,
        });

        if (options.json) {
          console.log(JSON.stringify(agents, null, 2));
        } else if (agents.length === 0) {
          logger.info("No agents found matching criteria");
        } else {
          logger.log(chalk.bold(`Discovered ${agents.length} agents:\n`));
          for (const a of agents) {
            logger.log(`  ${chalk.cyan(a.name)} ${chalk.gray(a.id)}`);
            if (a.description) logger.log(`    ${chalk.white(a.description)}`);
            if (a.capabilities.length)
              logger.log(
                `    Capabilities: ${chalk.yellow(a.capabilities.join(", "))}`,
              );
            if (a.skills.length)
              logger.log(`    Skills: ${chalk.yellow(a.skills.join(", "))}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a submit <agent-id> <input>
  a2a
    .command("submit")
    .description("Submit a task to an agent")
    .argument("<agent-id>", "Target agent ID")
    .argument("<input>", "Task input")
    .option("--json", "Output as JSON")
    .action(async (agentId, input, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = sendTask(db, agentId, input);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          logger.success(
            `Task submitted: ${chalk.gray(result.taskId)} [${chalk.yellow(result.status)}]`,
          );
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a status <task-id>
  a2a
    .command("status")
    .description("Get task status")
    .argument("<task-id>", "Task ID")
    .option("--json", "Output as JSON")
    .action(async (taskId, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const task = getTaskStatus(db, taskId);

        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
        } else {
          logger.log(chalk.bold("Task Status:\n"));
          logger.log(`  ID:     ${chalk.gray(task.id)}`);
          logger.log(`  Agent:  ${chalk.cyan(task.agent_id)}`);
          logger.log(`  Status: ${chalk.yellow(task.status)}`);
          if (task.input)
            logger.log(
              `  Input:  ${chalk.white(task.input.substring(0, 100))}`,
            );
          if (task.output)
            logger.log(
              `  Output: ${chalk.green(task.output.substring(0, 100))}`,
            );
          if (task.error) logger.log(`  Error:  ${chalk.red(task.error)}`);
          if (task.history.length) {
            logger.log("  History:");
            for (const h of task.history) {
              logger.log(
                `    ${chalk.gray(h.timestamp)} → ${chalk.yellow(h.status)}`,
              );
            }
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a complete <task-id> <output>
  a2a
    .command("complete")
    .description("Mark a task as completed")
    .argument("<task-id>", "Task ID")
    .argument("<output>", "Task output")
    .action(async (taskId, output) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = completeTask(db, taskId, output);
        logger.success(
          `Task ${chalk.gray(taskId)} → ${chalk.green(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a fail <task-id> <error>
  a2a
    .command("fail")
    .description("Mark a task as failed")
    .argument("<task-id>", "Task ID")
    .argument("<error>", "Error message")
    .action(async (taskId, error) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const result = failTask(db, taskId, error);
        logger.success(
          `Task ${chalk.gray(taskId)} → ${chalk.red(result.status)}`,
        );

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a peers
  a2a
    .command("peers")
    .description("List all registered agents")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = listPeers(db);

        if (options.json) {
          console.log(JSON.stringify(peers, null, 2));
        } else if (peers.length === 0) {
          logger.info("No agents registered. Use 'a2a register' to add one.");
        } else {
          logger.log(chalk.bold(`${peers.length} registered agents:\n`));
          for (const p of peers) {
            const statusColor =
              p.status === "active" ? chalk.green : chalk.gray;
            logger.log(
              `  ${chalk.cyan(p.name)} ${chalk.gray(p.id)} ${statusColor(p.status)}`,
            );
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a cards
  a2a
    .command("cards")
    .description("List all agent cards with details")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const peers = listPeers(db);

        if (options.json) {
          console.log(JSON.stringify(peers, null, 2));
        } else if (peers.length === 0) {
          logger.info("No agent cards registered.");
        } else {
          logger.log(chalk.bold(`${peers.length} agent cards:\n`));
          for (const p of peers) {
            logger.log(`  ${chalk.cyan(p.name)} ${chalk.gray(p.id)}`);
            if (p.description) logger.log(`    Description: ${p.description}`);
            if (p.url) logger.log(`    URL: ${chalk.blue(p.url)}`);
            logger.log(`    Auth: ${p.auth_type}`);
            if (p.capabilities.length)
              logger.log(
                `    Capabilities: ${chalk.yellow(p.capabilities.join(", "))}`,
              );
            if (p.skills.length)
              logger.log(`    Skills: ${chalk.yellow(p.skills.join(", "))}`);
            logger.log("");
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });

  // a2a negotiate <agent-id> <capabilities>
  a2a
    .command("negotiate")
    .description("Check if an agent supports required capabilities")
    .argument("<agent-id>", "Agent ID")
    .argument("<capabilities>", "Comma-separated required capabilities")
    .option("--json", "Output as JSON")
    .action(async (agentId, capabilities, options) => {
      try {
        const ctx = await bootstrap({ verbose: program.opts().verbose });
        if (!ctx.db) {
          logger.error("Database not available");
          process.exit(1);
        }
        const db = ctx.db.getDatabase();
        const required = capabilities.split(",").map((s) => s.trim());
        const result = negotiateCapability(db, agentId, required);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.compatible) {
            logger.success("Agent is fully compatible");
          } else {
            logger.warn("Agent is not fully compatible");
          }
          if (result.supported.length) {
            logger.log(
              `  Supported: ${chalk.green(result.supported.join(", "))}`,
            );
          }
          if (result.missing.length) {
            logger.log(`  Missing:   ${chalk.red(result.missing.join(", "))}`);
          }
        }

        await shutdown();
      } catch (err) {
        logger.error(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
